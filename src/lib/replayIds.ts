// STABLE MESSAGE IDS FOR A REPLAYED SAVED CONVERSATION (ops_incident #337, 2026-09-25).
//
// The Results-Found sentence rotates (src/data/resultsFoundRotation.ts), and PR #3232 pinned the
// pick PER MESSAGE ID — `stableKey: m.id` — so a typewriter re-render cannot flip the sentence
// mid-typing. That memo is a module-level Map, so it holds for the whole JS session; its key is the
// only thing that decides whether an already-rendered turn keeps its wording.
//
// `openStatic` (agent.tsx — the LEGACY snapshot/replay fallback, used for a saved chat that carries
// no transcript) minted both of its ids with `uid()`, which is `'m' + Date.now() + random`. Ids are
// therefore stable only WITHIN one invocation: reopening the same legacy chat a second time minted a
// NEW results id, missed the memo, and re-rolled the rotation. The user saw the sentence above a
// search they had already read change wording by itself — the exact class PR #3232 shipped to remove.
// Counts were never affected (the count is the backend total, filled at the call site).
//
// The transcript path needs none of this: `restoreChat` (src/lib/chatTranscript.ts) returns the
// persisted `msgs` with their ORIGINAL ids, so a chat WITH a transcript already reopens byte-stable.
// This helper closes the one remaining path.
//
// A replayed conversation HAS a durable identity — its history entry id — so derive the ids from it
// instead of minting. `openStatic` replaces the entire transcript with exactly these two messages,
// so the only uniqueness requirement is userId ≠ resultsId, and the `hu:`/`hr:` prefixes cannot
// collide with a `uid()` value (those always begin with `m`).
//
// Executed — never grepped — by scripts/verify-replayed-turn-keeps-its-sentence.ts.

export type ReplayMsgIds = { userId: string; resultsId: string };

/**
 * The (userId, resultsId) pair for a replayed saved conversation.
 *
 * - `entryId` present → ids derived from it, so every reopen of that chat produces the SAME pair and
 *   every id-keyed per-message state (the rotation memo, doneTyping, revealCount) is reused rather
 *   than re-rolled.
 * - `entryId` absent (a replay with no sidebar entry to name) → fall back to `mintFresh`, i.e. the
 *   previous behaviour. There is nothing durable to key on, so a fresh pair is the honest answer.
 *
 * `mintFresh` is injected rather than imported so this stays a pure function the barrier can execute.
 */
export function replayMsgIds(
  entryId: string | null | undefined,
  mintFresh: () => string,
): ReplayMsgIds {
  if (entryId) return { userId: `hu:${entryId}`, resultsId: `hr:${entryId}` };
  return { userId: mintFresh(), resultsId: mintFresh() };
}
