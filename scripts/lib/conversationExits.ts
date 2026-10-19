/**
 * THE POPULATION OF CONVERSATION EXITS, IN ONE PLACE.
 *
 * Four separate barriers independently pinned `resetConversationState()`'s call-site count as a
 * literal `=== 2`:
 *
 *   scripts/verify-conversation-state-never-inherited.ts  §C
 *   scripts/verify-agent-clarification-preserves-state.ts
 *   scripts/verify-agent-scope-answer.ts
 *   scripts/verify-chat-persistence.ts
 *
 * That is four copies of one fact, and the cost is not theoretical: adding stop() as a third,
 * CORRECT exit (ops_incident #341, 2026-09-20) turned three of the four red with messages about
 * clarification state, scope answers and chat persistence — none of which had changed, and none of
 * which name the thing that actually moved. A guard whose failure message points away from the edit
 * is a guard people learn to edit until it is quiet.
 *
 * It is also the same shape this repo keeps paying for at a larger scale: a fact restated in N
 * places drifts in N-1 of them. So the number lives here once, as a DERIVATION from the named
 * population rather than as a digit, and the four barriers import it.
 *
 * ADDING OR REMOVING AN EXIT IS A ONE-LINE EDIT TO `RESET_EXITS` — and it is deliberately a list of
 * names, not a count, so the edit says WHICH exit changed and a reviewer can check the claim.
 * The real guard on the population remains §F of verify-conversation-state-never-inherited.ts,
 * which DISCOVERS transcript-replacing sites by shape and executes each registry claim; this module
 * is the cross-check that makes the other three barriers agree with it instead of with a stale
 * digit.
 */

/** Every conversation exit that must route through the one shared reset, by name. */
export const RESET_EXITS = [
  "startFresh — every sidebar reopen, «بحث» hop and `?seed=` link (agent.tsx's param-consuming effect)",
  "the New Chat handler — the ?fresh=… effect, inside runAfterAnimation",
  "stop()'s filter-origin branch — Stop during a Filter-originated search, which erases the transcript and router.replace('/')s away (ops_incident #341)",
] as const;

/** How many times agent.tsx calls the shared reset. */
export const resetCallSites = (src: string): number =>
  (src.match(/^\s*resetConversationState\(\);$/gm) ?? []).length;

/** The invariant the four barriers share: one call per named exit, no more and no fewer. */
export const resetCallSitesOk = (src: string): boolean =>
  resetCallSites(src) === RESET_EXITS.length;

/** A failure message that names the population instead of printing a bare number. */
export const resetCallSiteProblem = (src: string): string =>
  `agent.tsx calls resetConversationState() ${resetCallSites(src)} time(s); ${RESET_EXITS.length} conversation exits are registered:\n`
  + RESET_EXITS.map((e) => `        · ${e}`).join("\n")
  + `\n      If you ADDED an exit, add it to RESET_EXITS in scripts/lib/conversationExits.ts and classify it in`
  + `\n      verify-conversation-state-never-inherited.ts §F. If you REMOVED one, say which and why — an exit that`
  + `\n      stops routing through the reset is ops_incident #211/#271/#319/#341's class, four times over.`;
